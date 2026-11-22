import { useEffect, useState, useRef } from "react";
import { Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/router";
import { ListenerMap } from "@/components/ListenerMap";
import { VibeCheckBar } from "@/components/VibeCheckBar";

interface NowPlaying {
    now_playing: {
        song: {
            title: string;
            artist: string;
            art?: string;
        };
    };
    station: {
        name: string;
        listen_url: string;
    };
    live?: {
        is_live: boolean;
        streamer_name?: string;
    };
}

function safeUrl(value: string | string[] | undefined): string | null {
    if (typeof value !== "string") return null;
    try {
        const u = new URL(value);
        return u.protocol === "https:" ? u.toString() : null;
    } catch {
        return null;
    }
}

export default function Home() {
    const router = useRouter();
    const bannerSrc = safeUrl(router.query.banner);
    const bannerLink = safeUrl(router.query.link);
    const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(80);
    const [loadError, setLoadError] = useState(false);
    const [flashColor, setFlashColor] = useState<string | null>(null);
    const [isInIframe, setIsInIframe] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Detect if we're in an iframe
    useEffect(() => {
        setIsInIframe(window.self !== window.top);
    }, []);

    useEffect(() => {
        if (typeof window !== "undefined" && !audioRef.current) {
            audioRef.current = new Audio();
            audioRef.current.volume = volume / 100;
        }
    }, []);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume / 100;
        }
    }, [volume]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.muted = isMuted;
        }
    }, [isMuted]);

    useEffect(() => {
        const fetchNowPlaying = async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const res = await fetch("/api/now-playing", {
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!res.ok) throw new Error("Failed to fetch");

                const data = await res.json();
                setNowPlaying(data);
                setLoadError(false);

                if (audioRef.current && data.station.listen_url && !audioRef.current.src) {
                    audioRef.current.src = data.station.listen_url;
                }
            } catch (err) {
                console.error("Failed to fetch now playing:", err);
                setLoadError(true);
            }
        };

        fetchNowPlaying();
        const interval = setInterval(fetchNowPlaying, 15000);

        return () => clearInterval(interval);
    }, []);

    // Send height to parent if in iframe
    useEffect(() => {
        if (!isInIframe) return;
        
        const send = () => {
            if (window.parent) {
                window.parent.postMessage(
                    { type: "otw-widget-height", height: Math.ceil(document.documentElement.scrollHeight) },
                    "*"
                );
            }
        };
        
        const ro = new ResizeObserver(send);
        ro.observe(document.body);
        send();
        return () => ro.disconnect();
    }, [isInIframe]);

    const togglePlay = async () => {
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            try {
                await audioRef.current.play();
                setIsPlaying(true);
            } catch (err) {
                console.error("Failed to play:", err);
            }
        }
    };

    const handleVibeSubmit = (vibe: string, color: string) => {
        setFlashColor(color);
        setTimeout(() => setFlashColor(null), 100);
    };

    const song = nowPlaying?.now_playing.song;
    const isLive = nowPlaying?.live?.is_live ?? false;
    const streamerName = nowPlaying?.live?.streamer_name;

    // Compact iframe layout (320px height constraint)
    if (isInIframe) {
        return (
            <div className="bg-background p-2">
                <div className="w-full space-y-2">
                    {/* Compact Audio Player */}
                    <div className="flex items-center gap-2 bg-accent rounded-lg p-2">
                        <div className="w-12 h-12 rounded bg-muted flex-shrink-0 overflow-hidden">
                            {song?.art ? (
                                <img
                                    src={song.art}
                                    alt={`${song.title} artwork`}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <div className="w-6 h-6 border-2 border-muted-foreground rounded-full" />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            {loadError ? (
                                <>
                                    <div className="font-semibold text-foreground text-xs">
                                        OTW Radio
                                    </div>
                                    <div className="text-muted text-[10px]">
                                        Connecting...
                                    </div>
                                </>
                            ) : song ? (
                                <>
                                    {isLive && streamerName ? (
                                        <>
                                            <div className="flex items-center gap-1 mb-0.5">
                                                <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-[9px] font-mono font-semibold rounded uppercase">
                                                    LIVE
                                                </span>
                                            </div>
                                            <div className="font-semibold text-foreground truncate text-xs">
                                                {streamerName}
                                            </div>
                                            <div className="text-muted text-[10px] truncate">
                                                Live on OTW Radio
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="font-semibold text-foreground truncate text-xs">
                                                {song.title || "Unknown Track"}
                                            </div>
                                            <div className="text-muted text-[10px] truncate">
                                                {song.artist || "Unknown Artist"}
                                            </div>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="h-3 bg-muted rounded animate-pulse w-3/4 mb-1" />
                                    <div className="h-2 bg-muted rounded animate-pulse w-1/2" />
                                </>
                            )}
                        </div>

                        <Button
                            onClick={togglePlay}
                            size="icon"
                            variant="default"
                            className="h-8 w-8 shrink-0"
                            disabled={!nowPlaying}
                        >
                            {isPlaying ? (
                                <Pause className="h-4 w-4" />
                            ) : (
                                <Play className="h-4 w-4" />
                            )}
                        </Button>
                    </div>

                    {/* Vibe Check Bar - Compact */}
                    <VibeCheckBar 
                        nowPlaying={song ? {
                            title: song.title,
                            artist: song.artist,
                            id: undefined
                        } : undefined}
                        onVibeSubmit={handleVibeSubmit}
                    />

                    {/* Mini Listener Map */}
                    <div className="rounded-lg overflow-hidden" style={{ height: '180px' }}>
                        <ListenerMap flashColor={flashColor} />
                    </div>
                </div>
            </div>
        );
    }

    // Full page layout (normal view)
    return (
        <div className="min-h-screen bg-background">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                {bannerSrc && (
                    <div className="mb-8 overflow-hidden rounded-lg">
                        {bannerLink ? (
                            <a href={bannerLink} target="_blank" rel="noopener noreferrer sponsored">
                                <img src={bannerSrc} alt="Sponsor" className="block w-full h-auto" />
                            </a>
                        ) : (
                            <img src={bannerSrc} alt="" className="block w-full h-auto" />
                        )}
                    </div>
                )}

                <div className="space-y-6">
                    {/* Audio Player */}
                    <div className="flex items-center gap-4 bg-accent rounded-lg p-4">
                        <div className="w-16 h-16 rounded bg-muted flex-shrink-0 overflow-hidden">
                            {song?.art ? (
                                <img
                                    src={song.art}
                                    alt={`${song.title} artwork`}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <div className="w-8 h-8 border-2 border-muted-foreground rounded-full" />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            {loadError ? (
                                <>
                                    <div className="font-semibold text-foreground text-sm">
                                        OTW Radio
                                    </div>
                                    <div className="text-muted text-xs">
                                        Connecting...
                                    </div>
                                </>
                            ) : song ? (
                                <>
                                    {isLive && streamerName ? (
                                        <>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-mono font-semibold rounded uppercase">
                                                    LIVE
                                                </span>
                                            </div>
                                            <div className="font-semibold text-foreground truncate text-sm">
                                                {streamerName}
                                            </div>
                                            <div className="text-muted text-xs truncate">
                                                Live on OTW Radio
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="font-semibold text-foreground truncate text-sm">
                                                {song.title || "Unknown Track"}
                                            </div>
                                            <div className="text-muted text-xs truncate">
                                                {song.artist || "Unknown Artist"}
                                            </div>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="h-4 bg-muted rounded animate-pulse w-3/4 mb-2" />
                                    <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                                </>
                            )}
                        </div>

                        <Button
                            onClick={togglePlay}
                            size="icon"
                            variant="default"
                            className="h-10 w-10 shrink-0"
                            disabled={!nowPlaying}
                        >
                            {isPlaying ? (
                                <Pause className="h-5 w-5" />
                            ) : (
                                <Play className="h-5 w-5" />
                            )}
                        </Button>
                    </div>

                    {/* Vibe Check Bar */}
                    <VibeCheckBar 
                        nowPlaying={song ? {
                            title: song.title,
                            artist: song.artist,
                            id: undefined
                        } : undefined}
                        onVibeSubmit={handleVibeSubmit}
                    />

                    {/* Listener Map */}
                    <ListenerMap flashColor={flashColor} />
                </div>
            </div>
        </div>
    );
}