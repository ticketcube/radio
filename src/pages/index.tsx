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
    const [isCompact, setIsCompact] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Detect if we need compact layout - ALWAYS compact in iframe
    useEffect(() => {
        const checkCompact = () => {
            const inIframe = window.self !== window.top;
            // If in iframe, always compact. Otherwise check height.
            setIsCompact(inIframe ? true : window.innerHeight <= 600);
        };
        checkCompact();
        window.addEventListener('resize', checkCompact);
        return () => window.removeEventListener('resize', checkCompact);
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
        if (window.self === window.top) return;
        
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
    }, []);

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
        console.log('🎨 INDEX: Vibe submitted, setting flash color:', color);
        setFlashColor(color);
        setTimeout(() => {
            setFlashColor(null);
            console.log('🎨 INDEX: Flash color cleared');
        }, 1100);
    };

    const song = nowPlaying?.now_playing.song;
    const isLive = nowPlaying?.live?.is_live ?? false;
    const streamerName = nowPlaying?.live?.streamer_name;

    return (
        <div className={`bg-background ${isCompact ? 'h-screen overflow-hidden p-2' : 'min-h-screen'}`}>
            <div className={`mx-auto w-full ${isCompact ? 'h-full flex flex-col justify-between max-w-2xl' : 'container px-4 py-8 max-w-6xl'}`}>
                {!isCompact && bannerSrc && (
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

                <div className={`${isCompact ? 'flex-1 flex flex-col min-h-0 space-y-2' : 'space-y-6'}`}>
                    {/* Audio Player */}
                    <div className={`flex items-center bg-accent rounded-lg ${isCompact ? 'gap-2 p-2 flex-shrink-0' : 'gap-4 p-4'}`}>
                        <div className={`rounded bg-muted flex-shrink-0 overflow-hidden ${isCompact ? 'w-10 h-10' : 'w-16 h-16'}`}>
                            {song?.art ? (
                                <img
                                    src={song.art}
                                    alt={`${song.title} artwork`}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <div className={`border-2 border-muted-foreground rounded-full ${isCompact ? 'w-5 h-5' : 'w-8 h-8'}`} />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            {loadError ? (
                                <>
                                    <div className={`font-semibold text-foreground ${isCompact ? 'text-xs' : 'text-sm'}`}>
                                        OTW Radio
                                    </div>
                                    <div className={`text-muted ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                        Connecting...
                                    </div>
                                </>
                            ) : song ? (
                                <>
                                    {isLive && streamerName ? (
                                        <>
                                            <div className="flex items-center gap-1 mb-0.5">
                                                <span className={`bg-primary text-primary-foreground font-mono font-semibold rounded uppercase ${isCompact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[10px]'}`}>
                                                    LIVE
                                                </span>
                                            </div>
                                            <div className={`font-semibold text-foreground truncate ${isCompact ? 'text-xs' : 'text-sm'}`}>
                                                {streamerName}
                                            </div>
                                            <div className={`text-muted truncate ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                                Live on OTW Radio
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className={`font-semibold text-foreground truncate ${isCompact ? 'text-xs' : 'text-sm'}`}>
                                                {song.title || "Unknown Track"}
                                            </div>
                                            <div className={`text-muted truncate ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                                {song.artist || "Unknown Artist"}
                                            </div>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className={`bg-muted rounded animate-pulse w-3/4 ${isCompact ? 'h-3 mb-1' : 'h-4 mb-2'}`} />
                                    <div className={`bg-muted rounded animate-pulse w-1/2 ${isCompact ? 'h-2' : 'h-3'}`} />
                                </>
                            )}
                        </div>

                        <Button
                            onClick={togglePlay}
                            size="icon"
                            variant="default"
                            className={`shrink-0 ${isCompact ? 'h-8 w-8' : 'h-10 w-10'}`}
                            disabled={!nowPlaying}
                        >
                            {isPlaying ? (
                                <Pause className={isCompact ? 'h-4 w-4' : 'h-5 w-5'} />
                            ) : (
                                <Play className={isCompact ? 'h-4 w-4' : 'h-5 w-5'} />
                            )}
                        </Button>
                    </div>

                    {/* Vibe Check Bar */}
                    <div className={isCompact ? 'flex-shrink-0' : ''}>
                        <VibeCheckBar 
                            nowPlaying={song ? {
                                title: song.title,
                                artist: song.artist,
                                id: undefined
                            } : undefined}
                            onVibeSubmit={handleVibeSubmit}
                            compact={isCompact}
                        />
                    </div>

                    {/* Listener Map */}
                    <div className={isCompact ? 'flex-1 min-h-0' : ''}>
                        <ListenerMap flashColor={flashColor} compact={isCompact} />
                    </div>
                </div>
            </div>
        </div>
    );
}